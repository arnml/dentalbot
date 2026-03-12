"use client";

import { useState, useTransition } from "react";
import { buildTimeOptions, formatDateLabel } from "@/lib/date";
import {
  AvailabilityResponse,
  BookingResponse,
  Doctor,
  Service,
  SuggestedSlot,
} from "@/lib/types";

interface BookingCheckerProps {
  doctors: Doctor[];
  services: Service[];
  upcomingDates: string[];
}

const timeOptions = buildTimeOptions();

async function requestAvailability(params: URLSearchParams) {
  const response = await fetch(`/api/availability?${params.toString()}`, {
    method: "GET",
  });

  const payload = (await response.json()) as
    | AvailabilityResponse
    | { error?: string };

  if (!response.ok) {
    const message = "error" in payload ? payload.error : undefined;
    throw new Error(message ?? "Unable to check availability.");
  }

  return payload as AvailabilityResponse;
}

export function BookingChecker({
  doctors,
  services,
  upcomingDates,
}: BookingCheckerProps) {
  const [patientName, setPatientName] = useState("Jordan Lee");
  const [doctorId, setDoctorId] = useState<string>("mario");
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? "");
  const [date, setDate] = useState(upcomingDates[1] ?? upcomingDates[0] ?? "");
  const [time, setTime] = useState("10:00");
  const [result, setResult] = useState<AvailabilityResponse | null>(null);
  const [bookingMessage, setBookingMessage] = useState<string | null>(null);
  const [bookingAlternatives, setBookingAlternatives] = useState<SuggestedSlot[]>(
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChecking, startChecking] = useTransition();
  const [isBooking, startBooking] = useTransition();

  function buildParams() {
    const params = new URLSearchParams({
      serviceId,
      date,
      time,
    });

    if (doctorId) {
      params.set("doctorId", doctorId);
    }

    return params;
  }

  function handleCheck(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setBookingMessage(null);

    startChecking(() => {
      void requestAvailability(buildParams())
        .then((payload) => {
          setResult(payload);
          setBookingAlternatives(payload.alternatives);
        })
        .catch((error: Error) => {
          setResult(null);
          setBookingAlternatives([]);
          setErrorMessage(error.message);
        });
    });
  }

  function handleBook() {
    setErrorMessage(null);
    setBookingMessage(null);

    startBooking(() => {
      void (async () => {
        const response = await fetch("/api/bookings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            patientName,
            doctorId,
            serviceId,
            date,
            time,
          }),
        });

        const payload = (await response.json()) as
          | BookingResponse
          | { error?: string; alternatives?: SuggestedSlot[] };

        if (!response.ok) {
          const message = "error" in payload ? payload.error : undefined;
          const alternatives =
            "alternatives" in payload ? payload.alternatives : [];
          setErrorMessage(message ?? "Unable to reserve this slot.");
          setBookingAlternatives(alternatives ?? []);
          setResult(null);
          return;
        }

        setBookingMessage((payload as BookingResponse).message);
        setBookingAlternatives((payload as BookingResponse).alternatives);
        const refreshed = await requestAvailability(buildParams());
        setResult(refreshed);
      })().catch(() => {
        setErrorMessage("Unable to reserve this slot.");
      });
    });
  }

  function handleReset() {
    setErrorMessage(null);
    setBookingMessage(null);

    startBooking(() => {
      void fetch("/api/bookings", { method: "DELETE" })
        .then((response) => response.json())
        .then((payload: { message?: string }) => {
          setResult(null);
          setBookingAlternatives([]);
          setBookingMessage(payload.message ?? "Demo bookings reset.");
        })
        .catch(() => {
          setErrorMessage("Unable to reset in-memory bookings.");
        });
    });
  }

  return (
    <section className="panel p-6 md:p-8">
      <div className="relative z-10">
        <div className="flex flex-wrap gap-2">
          <span className="pill">Booking engine</span>
          <span className="pill">In-memory state</span>
        </div>

        <h2 className="mt-5 max-w-2xl font-display text-3xl leading-tight text-white md:text-4xl">
          Check availability and reserve a demo appointment
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
          This is a true demo flow, not static copy. The app validates a slot
          against the running in-memory schedule, then lets you reserve it so
          the next check sees the updated state.
        </p>

        <form className="mt-7 grid gap-4 md:grid-cols-2" onSubmit={handleCheck}>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-200">
              Patient name
            </span>
            <input
              className="input-shell"
              onChange={(event) => setPatientName(event.target.value)}
              placeholder="Jordan Lee"
              value={patientName}
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-200">Doctor</span>
            <select
              className="input-shell"
              onChange={(event) => setDoctorId(event.target.value)}
              value={doctorId}
            >
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-200">
              Service
            </span>
            <select
              className="input-shell"
              onChange={(event) => setServiceId(event.target.value)}
              value={serviceId}
            >
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-200">Date</span>
              <select
                className="input-shell"
                onChange={(event) => setDate(event.target.value)}
                value={date}
              >
                {upcomingDates.map((item) => (
                  <option key={item} value={item}>
                    {formatDateLabel(item)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-200">Time</span>
              <select
                className="input-shell"
                onChange={(event) => setTime(event.target.value)}
                value={time}
              >
                {timeOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-3 md:col-span-2">
            <button className="primary-button" disabled={isChecking} type="submit">
              {isChecking ? "Checking..." : "Check availability"}
            </button>
            <button
              className="secondary-button"
              disabled={isBooking}
              onClick={handleReset}
              type="button"
            >
              Reset demo bookings
            </button>
          </div>
        </form>

        {errorMessage ? (
          <div className="mt-6 rounded-[24px] border border-rose-400/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {bookingMessage ? (
          <div className="mt-6 rounded-[24px] border border-emerald-400/20 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
            {bookingMessage}
          </div>
        ) : null}

        {result ? (
          <div
            className={`mt-6 rounded-[26px] border px-5 py-5 ${
              result.available
                ? "border-emerald-400/20 bg-emerald-500/10"
                : "border-amber-400/20 bg-amber-500/10"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
              Availability result
            </p>
            <h3 className="mt-3 text-xl font-semibold text-white">
              {result.message}
            </h3>

            {result.available ? (
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  className="primary-button"
                  disabled={isBooking || patientName.trim().length === 0}
                  onClick={handleBook}
                  type="button"
                >
                  {isBooking ? "Booking..." : "Reserve this slot"}
                </button>
                <p className="self-center text-sm text-slate-300">
                  Reservation is stored only in memory while the app is running.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {bookingAlternatives.length > 0 ? (
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {bookingAlternatives.map((slot) => (
              <article
                key={`${slot.doctorId}-${slot.date}-${slot.time}`}
                className="rounded-[22px] border border-white/10 bg-white/[0.05] p-4 transition duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.07]"
              >
                <p className="text-sm font-semibold text-white">
                  {slot.doctorName}
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  {formatDateLabel(slot.date)} at {slot.time}
                </p>
                <p className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                  {slot.serviceName}
                </p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

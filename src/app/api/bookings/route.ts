import { NextRequest, NextResponse } from "next/server";
import { findAvailability, getSuggestedSlots } from "@/lib/availability";
import { createBooking, getBookings, resetBookings } from "@/lib/booking-store";
import { getDoctorById, getServiceById, isDoctorId, isServiceId } from "@/lib/clinic-data";
import { BookingPayload } from "@/lib/types";

function isValidPayload(payload: Partial<BookingPayload>): payload is BookingPayload {
  return (
    Boolean(payload.patientName?.trim()) &&
    Boolean(payload.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)) &&
    Boolean(payload.time && /^\d{2}:\d{2}$/.test(payload.time)) &&
    isDoctorId(payload.doctorId ?? null) &&
    isServiceId(payload.serviceId ?? null)
  );
}

export function GET() {
  return NextResponse.json({
    bookings: getBookings(),
  });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as Partial<BookingPayload>;

  if (!isValidPayload(payload)) {
    return NextResponse.json(
      {
        error:
          "doctorId, serviceId, patientName, date e time são obrigatórios.",
      },
      { status: 400 },
    );
  }

  const availability = findAvailability({
    doctorId: payload.doctorId,
    serviceId: payload.serviceId,
    date: payload.date,
    time: payload.time,
  });

  if (!availability.available) {
    return NextResponse.json(
      {
        error: "Esse horário não está mais disponível.",
        alternatives: availability.alternatives,
      },
      { status: 409 },
    );
  }

  const booking = createBooking(payload);

  return NextResponse.json({
    message: `${payload.patientName} foi agendado com ${getDoctorById(payload.doctorId).name} para ${getServiceById(payload.serviceId).name}.`,
    booking,
    alternatives: getSuggestedSlots({
      doctorId: payload.doctorId,
      serviceId: payload.serviceId,
      limit: 3,
      startDate: payload.date,
      requestedTime: payload.time,
      excludeRequested: true,
    }),
  });
}

export function DELETE() {
  const bookings = resetBookings();

  return NextResponse.json({
    message: "Os agendamentos em memória do demo foram reiniciados.",
    bookings,
  });
}

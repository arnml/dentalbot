import { listUpcomingDates } from "@/lib/date";
import { BookingPayload, BookingRecord } from "@/lib/types";

function createSeedBookings(): BookingRecord[] {
  const upcoming = listUpcomingDates(10);

  return [
    {
      id: "seed-mario-1",
      doctorId: "mario",
      serviceId: "exam-cleaning",
      date: upcoming[0],
      time: "09:00",
      patientName: "Ana Ribeiro",
      createdAt: `${upcoming[0]}T08:15:00`,
    },
    {
      id: "seed-mario-2",
      doctorId: "mario",
      serviceId: "implant-consult",
      date: upcoming[1],
      time: "14:00",
      patientName: "Thomas Clark",
      createdAt: `${upcoming[1]}T09:40:00`,
    },
    {
      id: "seed-mario-3",
      doctorId: "mario",
      serviceId: "whitening",
      date: upcoming[2],
      time: "10:30",
      patientName: "Lila Foster",
      createdAt: `${upcoming[2]}T08:55:00`,
    },
    {
      id: "seed-mario-4",
      doctorId: "mario",
      serviceId: "emergency",
      date: upcoming[4],
      time: "11:30",
      patientName: "Jonah Reed",
      createdAt: `${upcoming[4]}T10:02:00`,
    },
    {
      id: "seed-stefania-1",
      doctorId: "stefania",
      serviceId: "pediatric-visit",
      date: upcoming[0],
      time: "08:30",
      patientName: "Theo Martin",
      createdAt: `${upcoming[0]}T08:00:00`,
    },
    {
      id: "seed-stefania-2",
      doctorId: "stefania",
      serviceId: "exam-cleaning",
      date: upcoming[1],
      time: "11:00",
      patientName: "Rachel Kim",
      createdAt: `${upcoming[1]}T10:22:00`,
    },
    {
      id: "seed-stefania-3",
      doctorId: "stefania",
      serviceId: "whitening",
      date: upcoming[2],
      time: "13:00",
      patientName: "Ivy Patel",
      createdAt: `${upcoming[2]}T11:41:00`,
    },
    {
      id: "seed-stefania-4",
      doctorId: "stefania",
      serviceId: "implant-consult",
      date: upcoming[3],
      time: "09:30",
      patientName: "Victor Hall",
      createdAt: `${upcoming[3]}T08:26:00`,
    },
  ];
}

let runtimeBookings = createSeedBookings();

export function getBookings(): BookingRecord[] {
  return runtimeBookings;
}

export function createBooking(payload: BookingPayload): BookingRecord {
  const booking: BookingRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...payload,
  };

  runtimeBookings = [...runtimeBookings, booking];
  return booking;
}

export function resetBookings(): BookingRecord[] {
  runtimeBookings = createSeedBookings();
  return runtimeBookings;
}

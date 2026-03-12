import {
  doctors,
  getDoctorById,
  getServiceById,
} from "@/lib/clinic-data";
import { getBookings } from "@/lib/booking-store";
import {
  formatDateLabel,
  getWeekday,
  listUpcomingDates,
  minutesToTime,
  overlaps,
  timeToMinutes,
} from "@/lib/date";
import {
  AvailabilityCheck,
  AvailabilityResponse,
  BookingRecord,
  BusinessWindow,
  Doctor,
  DoctorId,
  ServiceId,
  SuggestedSlot,
} from "@/lib/types";

const SLOT_STEP_MINUTES = 30;
const SUGGESTION_SEARCH_DAYS = 60;

function getWindowForDate(
  doctor: Doctor,
  date: string,
): BusinessWindow | undefined {
  const weekday = getWeekday(date);
  return doctor.weeklyTemplate.find((window) => window.weekday === weekday);
}

function slotFitsWindow(
  startMinutes: number,
  durationMinutes: number,
  window: BusinessWindow,
): boolean {
  const endMinutes = startMinutes + durationMinutes;
  const opensAt = timeToMinutes(window.start);
  const closesAt = timeToMinutes(window.end);

  if (startMinutes < opensAt || endMinutes > closesAt) {
    return false;
  }

  return !window.breaks?.some((item) =>
    overlaps(
      startMinutes,
      endMinutes,
      timeToMinutes(item.start),
      timeToMinutes(item.end),
    ),
  );
}

function slotOverlapsBookings(
  startMinutes: number,
  durationMinutes: number,
  bookings: BookingRecord[],
): boolean {
  const endMinutes = startMinutes + durationMinutes;

  return bookings.some((booking) => {
    const bookingStart = timeToMinutes(booking.time);
    const bookingEnd =
      bookingStart + getServiceById(booking.serviceId).durationMinutes;

    return overlaps(startMinutes, endMinutes, bookingStart, bookingEnd);
  });
}

export function isSlotAvailable(
  doctor: Doctor,
  date: string,
  serviceId: ServiceId,
  time: string,
  bookings = getBookings(),
): boolean {
  const window = getWindowForDate(doctor, date);
  if (!window) {
    return false;
  }

  const durationMinutes = getServiceById(serviceId).durationMinutes;
  const startMinutes = timeToMinutes(time);

  if (!slotFitsWindow(startMinutes, durationMinutes, window)) {
    return false;
  }

  const sameDoctorDayBookings = bookings.filter(
    (booking) => booking.doctorId === doctor.id && booking.date === date,
  );

  return !slotOverlapsBookings(
    startMinutes,
    durationMinutes,
    sameDoctorDayBookings,
  );
}

function buildSuggestedSlot(
  doctorId: DoctorId,
  date: string,
  time: string,
  serviceId: ServiceId,
): SuggestedSlot {
  return {
    doctorId,
    doctorName: getDoctorById(doctorId).name,
    date,
    time,
    serviceId,
    serviceName: getServiceById(serviceId).name,
  };
}

export function getSuggestedSlots({
  doctorId,
  serviceId,
  limit = 6,
  startDate,
  endDate,
  requestedTime,
  excludeRequested = false,
}: {
  doctorId?: DoctorId;
  serviceId: ServiceId;
  limit?: number;
  startDate?: string;
  endDate?: string;
  requestedTime?: string;
  excludeRequested?: boolean;
}): SuggestedSlot[] {
  const targetDoctors = doctorId ? [getDoctorById(doctorId)] : doctors;
  const service = getServiceById(serviceId);
  const dates = listUpcomingDates(SUGGESTION_SEARCH_DAYS).filter(
    (date) =>
      (!startDate || date >= startDate) && (!endDate || date <= endDate),
  );
  const suggestions: SuggestedSlot[] = [];

  for (const date of dates) {
    for (const doctor of targetDoctors) {
      const window = getWindowForDate(doctor, date);
      if (!window) {
        continue;
      }

      let candidate = timeToMinutes(window.start);
      const latestStart = timeToMinutes(window.end) - service.durationMinutes;

      while (candidate <= latestStart) {
        const time = minutesToTime(candidate);
        const isRequestedSlot =
          excludeRequested && date === startDate && time === requestedTime;

        if (
          !isRequestedSlot &&
          isSlotAvailable(doctor, date, serviceId, time)
        ) {
          suggestions.push(buildSuggestedSlot(doctor.id, date, time, serviceId));
        }

        if (suggestions.length >= limit) {
          return suggestions;
        }

        candidate += SLOT_STEP_MINUTES;
      }
    }
  }

  return suggestions;
}

export function findAvailability(
  request: AvailabilityCheck,
): AvailabilityResponse {
  const service = getServiceById(request.serviceId);
  const targetDoctors = request.doctorId
    ? [getDoctorById(request.doctorId)]
    : doctors;

  const availableDoctor = targetDoctors.find((doctor) =>
    isSlotAvailable(doctor, request.date, request.serviceId, request.time),
  );

  if (availableDoctor) {
    return {
      available: true,
      message: `${availableDoctor.name} tem horário em ${formatDateLabel(request.date)}, às ${request.time}, para ${service.name}.`,
      requested: {
        doctorId: availableDoctor.id,
        doctorName: availableDoctor.name,
        serviceId: request.serviceId,
        serviceName: service.name,
        date: request.date,
        time: request.time,
      },
      alternatives: getSuggestedSlots({
        doctorId: availableDoctor.id,
        serviceId: request.serviceId,
        limit: 3,
        startDate: request.date,
        requestedTime: request.time,
        excludeRequested: true,
      }),
    };
  }

  const requestedDoctorName = request.doctorId
    ? getDoctorById(request.doctorId).name
    : "a equipe da clínica";

  return {
    available: false,
    message: `${requestedDoctorName} não tem horário em ${formatDateLabel(request.date)}, às ${request.time}, para ${service.name}.`,
    requested: {
      doctorId: request.doctorId,
      doctorName: requestedDoctorName,
      serviceId: request.serviceId,
      serviceName: service.name,
      date: request.date,
      time: request.time,
    },
    alternatives: getSuggestedSlots({
      doctorId: request.doctorId,
      serviceId: request.serviceId,
      limit: 6,
      startDate: request.date,
      requestedTime: request.time,
      excludeRequested: true,
    }),
  };
}

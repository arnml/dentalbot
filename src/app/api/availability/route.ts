import { NextRequest, NextResponse } from "next/server";
import { findAvailability } from "@/lib/availability";
import { isDoctorId, isServiceId } from "@/lib/clinic-data";

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const serviceId = searchParams.get("serviceId");
  const doctorId = searchParams.get("doctorId");
  const date = searchParams.get("date");
  const time = searchParams.get("time");

  if (!serviceId || !isServiceId(serviceId)) {
    return NextResponse.json(
      { error: "É necessário informar um serviceId válido." },
      { status: 400 },
    );
  }

  if (doctorId && !isDoctorId(doctorId)) {
    return NextResponse.json(
      { error: "doctorId deve ser mario ou stefania." },
      { status: 400 },
    );
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date deve usar o formato YYYY-MM-DD." },
      { status: 400 },
    );
  }

  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json(
      { error: "time deve usar o formato HH:MM." },
      { status: 400 },
    );
  }

  const safeDoctorId = doctorId && isDoctorId(doctorId) ? doctorId : undefined;
  const safeServiceId = serviceId;

  return NextResponse.json(
    findAvailability({
      doctorId: safeDoctorId,
      serviceId: safeServiceId,
      date,
      time,
    }),
  );
}

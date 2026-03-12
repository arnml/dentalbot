import { ChatBookingAssistant } from "@/components/chat-booking-assistant";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <main className="relative h-dvh overflow-hidden">
      <div className="pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex h-full max-w-[56rem] flex-col gap-5 px-4 py-4 md:px-6 md:py-6">
        <section id="demo" className="mx-auto min-h-0 flex-1 w-full max-w-[36rem]">
          <ChatBookingAssistant />
        </section>
      </div>
    </main>
  );
}

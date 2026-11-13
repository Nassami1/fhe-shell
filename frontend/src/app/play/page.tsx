import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { InviteTable } from "@/components/InviteTable";

export default function PlayPage() {
  return (
    <>
      <SiteHeader />
      <Suspense fallback={<main className="wrap"><p>Setting the table…</p></main>}>
        <InviteTable />
      </Suspense>
    </>
  );
}

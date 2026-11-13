import { SiteHeader } from "@/components/SiteHeader";
import { Showdown } from "@/components/Showdown";

export default function ShowdownPage() {
  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <section>
          <h1>Enter the showdown</h1>
          <p>Buy a box, decrypt only your power, then challenge or fold. The contract compares the encrypted scores.</p>
          <Showdown />
        </section>
      </main>
    </>
  );
}

import Link from "next/link";
import { WalletButton } from "@/lib/wallet";

export function SiteHeader() {
  return (
    <header className="site wrap">
      <Link href="/" className="brand">
        <img src="/logo.svg" alt="Provable Mystery Box logo" />
        Mystery Box Showdown
      </Link>
      <nav>
        <Link href="/#odds">Odds</Link>
        <Link href="/#audit">Audit</Link>
        <WalletButton />
        <Link href="/play" className="btn">
          Play
        </Link>
      </nav>
    </header>
  );
}

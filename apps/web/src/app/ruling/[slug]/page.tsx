import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Ruling } from "@pvp/shared";
import { findStoredRuling } from "../../../server/services";
import { RulingView } from "../../../components/ruling-view";
import { ServiceNotice } from "../../../components/service-notice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Frozen ruling" };
export default async function RulingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let ruling: Ruling | null;
  try {
    ruling = await findStoredRuling(slug);
  } catch {
    return (
      <ServiceNotice
        title="This ruling could not be loaded."
        message="The stored evidence is temporarily unavailable. Try this permalink again when database access is restored; the ruling will not be recomputed."
      />
    );
  }
  if (!ruling) notFound();
  return <RulingView ruling={ruling} />;
}

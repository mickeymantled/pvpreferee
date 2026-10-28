import React from "react";
import { ServiceNotice } from "../components/service-notice";
export default function NotFound() {
  return (
    <ServiceNotice
      title="No ruling at this address."
      message="Check the permalink or open a new comparison. We will not substitute a different ruling."
    />
  );
}

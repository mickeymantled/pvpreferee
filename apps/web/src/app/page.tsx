import React from "react";
import { ComparisonForm } from "../components/forms";
import { listRulebooks } from '@pvp/config';
import { CaseSteps } from "../components/case-steps";

export default function HomePage() {
  return (
    <div className="case-workspace">
      <header className="page-heading home-heading">
        <h1>Same meme. One ruling.</h1>
        <p className="lede">
          Compare competing contracts against published rules, with evidence behind every call.
        </p>
      </header>
      <CaseSteps current="Contracts" />
      <ComparisonForm versions={listRulebooks()} />
    </div>
  );
}

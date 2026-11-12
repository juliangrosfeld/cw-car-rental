import { createFileRoute } from "@tanstack/react-router";
import LegalDocumentPage from "../components/site/legal-document";
import { TERMS } from "../content/legal/terms";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms & Conditions | CW Car Sales & Rental" },
      {
        name: "description",
        content:
          "The General Rental Terms & Conditions that apply to every vehicle rental from CW Car Sales & Rental in Curaçao.",
      },
    ],
  }),
  component: () => <LegalDocumentPage doc={TERMS} />,
});

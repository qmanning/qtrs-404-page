// Ready-made copy for the Q.T.R.S. error pages: spread it onto <Qtrs404 /> (see app/error.tsx).
// Built from errorMessages.ts into the same two short paragraphs the 404 uses.
import { getTetrisErrorMessage } from "./errorMessages";

const m = getTetrisErrorMessage("500");

export const QTRS_500 = {
    code: "500",
    title: "Error 500",
    lines: [m.subtitle.replace(/!$/, "."), `${m.description} QBOT is playing Q.T.R.S. meanwhile. Want a turn?`] as [string, string],
};

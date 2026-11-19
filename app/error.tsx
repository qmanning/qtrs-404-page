"use client";

import Qtrs404 from "../src/components/Qtrs404";
import { QTRS_500 } from "../src/lib/errorCopy";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return <Qtrs404 home="/" {...QTRS_500} onRetry={reset} />;
}

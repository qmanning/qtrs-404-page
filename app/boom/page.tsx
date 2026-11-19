// Throws on purpose so you can see the 500 version (app/error.tsx). Delete this folder in your own app.
export const dynamic = "force-dynamic";

export default function Boom(): never {
    throw new Error("Boom: the demo's on-purpose error");
}

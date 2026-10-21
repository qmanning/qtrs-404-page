import Qtrs404 from "../src/components/Qtrs404";

// The game as a page of its own. Try /nope for the real 404 and /boom for the 500.
export default function Home() {
    return (
        <Qtrs404
            home="/"
            code="qtrs"
            title="Q.T.R.S."
            lines={["Queue, Turn, Rotate, Slam. Can't find it? Have fun instead!", "Few things break a creative block like Q.T.R.S. QBOT is playing right now. Want a turn?"]}
        />
    );
}

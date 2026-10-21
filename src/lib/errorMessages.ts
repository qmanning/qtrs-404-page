// Q.T.R.S. error copy per status code (404, 500, ...).
export interface ErrorMessage {
    title: string;
    subtitle: string;
    description: string;
    instruction: string;
}

export const tetrisErrorMessages: Record<string, ErrorMessage> = {
    // 404 - Page Not Found
    "404": {
        title: "404",
        subtitle: "This page fell through the cracks!",
        description:
            "Like a misdropped Q.T.R.S. piece, this page doesn't fit here. Maybe it rotated away or got cleared in a line combo.",
        instruction: "Play some Q.T.R.S. instead!",
    },

    // 500 - Internal Server Error
    "500": {
        title: "500",
        subtitle: "Our server got garbaged!",
        description:
            "Four lines of errors hit our system at once. We're clearing our stack piece by piece.",
        instruction: "Play Q.T.R.S. while we fix our blocks!",
    },

    // 403 - Forbidden
    "403": {
        title: "403",
        subtitle: "Access Blocked!",
        description:
            "This page is like a perfect Q.T.R.S. wall - no gaps to get through. You need the right piece (permissions) to clear this line.",
        instruction: "Play Q.T.R.S. while you wait for access!",
    },

    // 401 - Unauthorized
    "401": {
        title: "401",
        subtitle: "Wrong piece, wrong place!",
        description:
            "Looks like you're trying to fit an I-piece where only a T-piece belongs. Authentication required to continue.",
        instruction: "Login first, then play Q.T.R.S.!",
    },

    // 429 - Too Many Requests
    "429": {
        title: "429",
        subtitle: "Whoa, slow down there!",
        description:
            "You're dropping requests faster than Q.T.R.S. pieces on level 20. Take a breather and let the server catch up.",
        instruction: "Chill with some Q.T.R.S.!",
    },

    // 502 - Bad Gateway
    "502": {
        title: "502",
        subtitle: "Gateway jammed like a misplaced block!",
        description:
            "Our gateway is more stuck than an L-piece in the wrong rotation. We're working to clear the blockage.",
        instruction: "Play Q.T.R.S. while we unjam things!",
    },

    // 503 - Service Unavailable
    "503": {
        title: "503",
        subtitle: "Service temporarily paused!",
        description:
            "Our service hit the pause button like you do when the phone rings during a Q.T.R.S. marathon. We'll be back shortly.",
        instruction: "Perfect time for Q.T.R.S. practice!",
    },

    // 504 - Gateway Timeout
    "504": {
        title: "504",
        subtitle: "Connection dropped like a missed piece!",
        description:
            "Our gateway timed out faster than a soft drop that went too far. Sometimes the timing just isn't right.",
        instruction: "Better luck with Q.T.R.S. timing!",
    },

    // Generic Error
    generic: {
        title: "Oops!",
        subtitle: "Something rotated the wrong way!",
        description:
            "An error occurred that's more confusing than trying to fit a Z-piece where an S-piece should go. But hey, that's what makes it challenging!",
        instruction: "Let's play Q.T.R.S. while we sort this out!",
    },

    // JavaScript Error
    javascript: {
        title: "Script Error",
        subtitle: "Code block doesn't fit!",
        description:
            "Our JavaScript got tangled up like Q.T.R.S. pieces falling too fast. Time to slow down and debug piece by piece.",
        instruction: "Debug with Q.T.R.S.!",
    },

    // Network Error
    network: {
        title: "Network Error",
        subtitle: "Connection lost in the stack!",
        description:
            "Your internet connection disappeared faster than a completed Q.T.R.S. line. Check your network and try again.",
        instruction: "Offline Q.T.R.S. still works!",
    },

    // Database Error
    database: {
        title: "Database Error",
        subtitle: "Storage overflow!",
        description:
            "Our database is more full than a Q.T.R.S. well at game over. We're clearing some space to make room for new data.",
        instruction: "Play Q.T.R.S. while we optimize!",
    },
};

/**
 * Get appropriate error message based on error type or code
 */
export function getTetrisErrorMessage(
    errorCode?: string | number,
    errorType?: string
): ErrorMessage {
    const code = errorCode?.toString();

    // Try exact error code match first
    if (code && tetrisErrorMessages[code]) {
        return tetrisErrorMessages[code];
    }

    // Try error type match
    if (errorType && tetrisErrorMessages[errorType.toLowerCase()]) {
        return tetrisErrorMessages[errorType.toLowerCase()];
    }

    // Fall back to generic error
    return tetrisErrorMessages.generic;
}

/**
 * Get random Tetris-themed loading message while game loads
 */
export const loadingMessages = [
    "Preparing the next piece...",
    "Clearing the well...",
    "Calibrating rotation matrix...",
    "Loading Tetris blocks...",
    "Stacking the deck...",
    "Arranging falling pieces...",
    "Setting up the playfield...",
    "Generating piece sequence...",
];

export function getRandomLoadingMessage(): string {
    return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
}

/**
 * Game achievement messages for special events
 */
export const achievementMessages = {
    single: "Nice clear!",
    double: "Double trouble!",
    triple: "Triple threat!",
    tetris: "TETRIS! Four lines of glory!",
    tSpin: "T-Spin! Style points!",
    perfectClear: "Perfect Clear! Amazing!",
    gameOver: "Game Over! That was fun, right?",
    levelUp: "Level Up! Things are heating up!",
};

export default tetrisErrorMessages;

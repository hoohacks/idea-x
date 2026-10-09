/**
 * Last year's funded teams, in prize order, with the photo of each holding the
 * cheque. Shown on the public pages because they answer the question a student
 * deciding whether to sign up actually has: what happens at the end.
 *
 * The photos are cropped from the originals to the team and their cheque, and
 * compressed for the web; the full-size files are not in the repo.
 */
const photo = (file) => `${import.meta.env.BASE_URL}photos/${file}`;

export const PAST_WINNERS_YEAR = 2025;

export const PAST_WINNERS = [
    {
        team: "Behind the Plate",
        prize: "$700",
        src: photo("winner-behind-the-plate.jpg"),
        width: 900,
        height: 863,
    },
    {
        team: "ClearCause",
        prize: "$450",
        src: photo("winner-clearcause.jpg"),
        width: 900,
        height: 656,
    },
    {
        team: "Tempo",
        prize: "$250",
        src: photo("winner-tempo.jpg"),
        width: 900,
        height: 993,
    },
    {
        team: "Circles",
        prize: "$100",
        src: photo("winner-circles.jpg"),
        width: 900,
        height: 560,
    },
].map((winner) => ({
    ...winner,
    alt: `${winner.team} holding their ${winner.prize} cheque at Ideathon ${PAST_WINNERS_YEAR}`,
}));

import type { MediaFile } from "../types";

/**
 * Demo catalogue for design previews (`/?demo=1`). Titles are invented and posters are generated
 * from the brand grain gradient, so nothing here depends on, or imitates, any real release.
 */
const FILMS: Array<[string, string, string, string]> = [
  ["Midnight Harvest", "2025", "4K", "A quiet farm town learns what grows after dark."],
  ["The Long Tide", "2024", "1080p", "Two sisters sail home to settle their father's last debt."],
  ["Glass Meridian", "2025", "4K", "A cartographer finds a city that is not on any map."],
  ["Neon Orchard", "2023", "1080p", "A heist crew, a rooftop garden and one very bad plan."],
  ["Salt & Ember", "2024", "1080p", "An ex-chef returns to the island kitchen that made her."],
  ["Paper Lanterns", "2022", "720p", "One festival night, six strangers, a missing key."],
  ["Hollow Signal", "2025", "4K", "A radio operator hears her own voice from tomorrow."],
  ["Velvet Static", "2023", "1080p", "A band reunites to finish the record that broke them."],
  ["Afterglow Run", "2024", "1080p", "A courier crosses the coast in a single, impossible night."],
  ["Kiln", "2021", "720p", "A potter's apprentice discovers the glaze is a confession."],
  ["The Quiet Quarter", "2025", "4K", "Three flats, one landlord, nobody telling the truth."],
  ["Orbit Street", "2022", "1080p", "Kids, bikes and a satellite that came down in the cul-de-sac."]
];
const SHOWS: Array<[string, string, number[], string]> = [
  ["Harbour Lights", "2024", [8, 8, 6], "A port city's night shift, and everyone it quietly keeps alive."],
  ["The Understudies", "2025", [10, 10], "Backstage at a failing theatre, the real drama never closes."],
  ["Copper Line", "2023", [8, 8, 8, 6], "A rail inspector follows a ghost freight across three countries."],
  ["Small Hours", "2025", [6], "Six strangers, one all-night café, one unspoken pact."],
  ["Field Notes", "2022", [10, 8], "A botanist's diary becomes a field guide to a family's secrets."],
  ["North of Summer", "2024", [8, 8], "Teenage rivals, a mountain lodge and a very long winter."]
];

let id = 1000;
export function buildDemoLibrary(): MediaFile[] {
  const out: MediaFile[] = [];
  const now = Date.now();
  FILMS.forEach(([title, year, quality, overview], i) => {
    out.push({
      id: id++, movie_id: `demo_${i}`, movie_title: title, year, telegram_file_id: "", quality, overview,
      file_size: (1.2 + (i % 5) * 0.7) * 1024 ** 3,
      created_at: new Date(now - i * 3.2 * 86400000).toISOString(),
      views: 480 - i * 37,
      all_qualities: [
        { id: id++, quality, file_size: (1.2 + (i % 5) * 0.7) * 1024 ** 3 },
        { id: id++, quality: "720p", file_size: 0.9 * 1024 ** 3 }
      ]
    });
  });
  SHOWS.forEach(([title, year, seasons, overview], i) => {
    const episodes: MediaFile[] = [];
    seasons.forEach((count, sIdx) => {
      for (let e = 1; e <= count; e++) {
        episodes.push({
          id: id++, movie_id: `demo_s${i}_${sIdx + 1}_${e}`, movie_title: title, year, telegram_file_id: "",
          quality: "1080p", season: sIdx + 1, episode: e, file_size: (0.4 + (e % 3) * 0.15) * 1024 ** 3
        });
      }
    });
    out.push({
      id: id++, movie_id: `demo_show_${i}`, movie_title: title, year, telegram_file_id: "", quality: "1080p", overview,
      is_series: true, seasons: seasons.map((_, k) => k + 1), total_episodes: episodes.length, episodes,
      created_at: new Date(now - (i * 2 + 1) * 86400000).toISOString(), views: 420 - i * 41
    });
  });
  return out;
}

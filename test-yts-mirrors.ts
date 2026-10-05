import axios from "axios";

const mirrors = [
  "https://yts.mx",
  "https://yts.ag",
  "https://yts.lt",
  "https://yts.am",
  "https://yts.pm",
  "https://api.consumet.org/movies/flixhq"
];

for (const m of mirrors) {
  try {
    const start = Date.now();
    await axios.get(`${m.startsWith("http") ? m : "https://"+m}`);
    console.log(`Success: ${m} in ${Date.now()-start}ms`);
  } catch(e) {
    console.log(`Failed: ${m} - ${e.message}`);
  }
}

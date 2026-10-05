import { searchOpenTracker } from "./src/services/torrentEngine.js";
searchOpenTracker("Inception").then(res => console.log(res)).catch(err => console.error(err));

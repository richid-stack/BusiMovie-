import { searchMovies } from "./dist/services/movieProvider.js";
searchMovies("inception").then(console.log).catch(console.error);

import { searchMovies } from "./src/services/movieProvider.js";
searchMovies("Inception").then(res => console.log(res)).catch(err => console.error(err));

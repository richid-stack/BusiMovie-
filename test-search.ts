import { searchVaultFilesDirect } from "./src/db/index.js";

async function test() {
  const p2026 = await searchVaultFilesDirect("Passenger 2026");
  console.log("Passenger 2026 count:", p2026.length, p2026.map(f => `${f.movie_title} (${f.quality})`));

  const p = await searchVaultFilesDirect("Passenger");
  console.log("Passenger count:", p.length, p.map(f => `${f.movie_title} (${f.quality})`));

  const swat = await searchVaultFilesDirect("SWAT");
  console.log("SWAT count:", swat.length);

  const swatDot = await searchVaultFilesDirect("S.W.A.T.");
  console.log("S.W.A.T. count:", swatDot.length);

  const og = await searchVaultFilesDirect("Old Guard");
  console.log("Old Guard count:", og.length, og.map(f => f.movie_title));

  const fix = await searchVaultFilesDirect("The Fix");
  console.log("The Fix count:", fix.length, fix.map(f => f.movie_title));
}
test();

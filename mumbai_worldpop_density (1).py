# ============================================================
# Mumbai Urban Heat Island — WorldPop Population Density per Ward
# Colab-ready. No Google Earth Engine required.
# ============================================================

# --- 0. Install dependencies (Colab) ---
!pip install -q rasterio rasterstats geopandas requests

import os
import requests
import numpy as np
import geopandas as gpd
import rasterio
from rasterio.windows import from_bounds
from rasterio.errors import RasterioIOError
from rasterstats import zonal_stats

# ------------------------------------------------------------
# CONFIG
# ------------------------------------------------------------
WARDS_PATH = "wards_raw.geojson"          # your ward polygons
RASTER_URL = "https://data.worldpop.org/GIS/Population_Density/Global_2000_2020_1km/2020/IND/ind_pd_2020_1km.tif"
RASTER_LOCAL_PATH = "ind_pd_2020_1km.tif"
OUTPUT_CSV = "worldpop_density.csv"

# Mumbai bounding box (lng/lat, WGS84) — slightly padded
MUMBAI_BOUNDS = {
    "minx": 72.75,
    "miny": 18.87,
    "maxx": 73.00,
    "maxy": 19.30,
}

# ------------------------------------------------------------
# STEP 1 & 2: Download + load the raster (with fallback instructions)
# ------------------------------------------------------------
def download_raster(url, local_path):
    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        print(f"[info] {local_path} already exists locally, skipping download.")
        return local_path

    print(f"[info] Downloading WorldPop India population density raster...")
    print(f"       Source: {url}")
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    downloaded = 0
    chunk_size = 1024 * 1024  # 1 MB chunks

    with open(local_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=chunk_size):
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    print(f"\r       {downloaded/1e6:.1f} MB / {total/1e6:.1f} MB ({pct:.0f}%)", end="")
    print()
    print(f"[info] Download complete: {local_path} ({os.path.getsize(local_path)/1e6:.1f} MB)")
    return local_path


def clip_raster_to_mumbai(raster_path, bounds):
    """Reads only the Mumbai window from the raster — never loads all of India into memory."""
    with rasterio.open(raster_path) as src:
        window = from_bounds(
            bounds["minx"], bounds["miny"], bounds["maxx"], bounds["maxy"],
            transform=src.transform
        )
        clipped_array = src.read(1, window=window)
        clipped_transform = src.window_transform(window)
        nodata = src.nodata
        crs = src.crs

    print(f"[info] Clipped raster shape: {clipped_array.shape} (rows, cols)")
    return clipped_array, clipped_transform, nodata, crs


try:
    download_raster(RASTER_URL, RASTER_LOCAL_PATH)
    clipped_array, clipped_transform, nodata, raster_crs = clip_raster_to_mumbai(
        RASTER_LOCAL_PATH, MUMBAI_BOUNDS
    )

except (requests.exceptions.RequestException, RasterioIOError, Exception) as e:
    print("=" * 70)
    print("[ERROR] Automatic download/processing of the WorldPop raster failed.")
    print(f"        Reason: {e}")
    print()
    print("MANUAL FIX:")
    print("  1. Go to: https://hub.worldpop.org/geodata/summary?id=36764")
    print("     (or navigate: hub.worldpop.org > Population Density >")
    print("      Unconstrained individual countries 2000-2020 > India, 1km resolution)")
    print("  2. Download the 2020 GeoTIFF (ind_pd_2020_1km.tif).")
    print(f"  3. Upload/place it in this Colab session's working directory as:")
    print(f"       {os.path.abspath(RASTER_LOCAL_PATH)}")
    print("  4. Re-run this cell.")
    print("=" * 70)
    raise SystemExit("Stopped: raster not available. See manual instructions above.")

# ------------------------------------------------------------
# STEP 3: (clipping already done above via windowed read)
# ------------------------------------------------------------

# ------------------------------------------------------------
# STEP 4: Load wards and compute zonal stats
# ------------------------------------------------------------
try:
    wards = gpd.read_file(WARDS_PATH)

    if "ward_name" not in wards.columns:
        raise ValueError(
            f"'ward_name' column not found in {WARDS_PATH}. "
            f"Columns present: {list(wards.columns)}"
        )

    # Reproject wards to match raster CRS (WorldPop is EPSG:4326) if needed
    if raster_crs is not None and wards.crs is not None and wards.crs.to_string() != raster_crs.to_string():
        print(f"[info] Reprojecting wards from {wards.crs} to {raster_crs}")
        wards = wards.to_crs(raster_crs)
    elif wards.crs is None:
        print("[warn] wards_raw.geojson has no CRS set — assuming EPSG:4326 to match WorldPop.")
        wards = wards.set_crs(epsg=4326)

    stats = zonal_stats(
        vectors=wards,
        raster=clipped_array,
        affine=clipped_transform,
        stats=["mean"],
        nodata=nodata if nodata is not None else -99999,
        geojson_out=False,
    )

    wards["population_density_worldpop"] = [s["mean"] for s in stats]

    out_df = wards[["ward_name", "population_density_worldpop"]]

    # ------------------------------------------------------------
    # STEP 5: Write output CSV
    # ------------------------------------------------------------
    out_df.to_csv(OUTPUT_CSV, index=False)
    print(f"[success] Wrote {OUTPUT_CSV} with {len(out_df)} wards.")
    print(out_df.head())

except Exception as e:
    print("=" * 70)
    print("[ERROR] Zonal statistics step failed.")
    print(f"        Reason: {e}")
    print("Check that wards_raw.geojson exists, has a 'ward_name' column,")
    print("and that its geometries actually fall within the Mumbai bounding box:")
    print(f"  {MUMBAI_BOUNDS}")
    print("=" * 70)
    raise

# ML hotspot discovery (DBSCAN)

The Explore page now includes an **ML hotspot discovery** panel. It applies DBSCAN, an unsupervised machine-learning clustering algorithm, to the **currently loaded** NASA FIRMS satellite detections. It groups qualifying hotspots within a 25 km geodesic radius when at least three observations form a dense neighborhood; isolated points are noise. Clicking a group centers the map near it.

Implementation: `frontend/src/utils/hotspotDbscan.js`, tested in `hotspotDbscan.test.js`. This algorithm does **not** require model training, labeled data, a new API key, or a database migration. It is separate from the zoom-dependent marker grouping and from the weighted environmental risk score.

**Limitations:** Clusters are spatial concentrations of observations, not confirmed wildfire incidents, fire spread predictions, or probabilities. Multiple satellite observations may correspond to one incident, and old records can appear alongside newer ones. Only the API's loaded subset (normally up to 200, capped at 1,000) is analyzed; missing/invalid coordinates and low-confidence classifications are excluded. This is a descriptive exploration tool, not an emergency alert service.

## Parameter choices

The initial **25 km radius** is an exploratory neighborhood size: it groups observations close enough to inspect together without claiming they represent the same fire. It is not a learned or calibrated fire-spread distance. The **minimum of 3 observations** filters out isolated detections and pairs, reducing noisy groups while retaining small concentrations. These are starting defaults, not validated thresholds; results are sensitive to spatial density, repeat satellite passes, and the geographic/temporal coverage of the loaded sample. Clustering is spatial only, so users must check observation timestamps separately.

## Review and regression coverage

The clustering calculation is memoized by the detections array to avoid recomputing on unrelated UI state changes. The discovery panel is tested separately for empty groups, group counts, readable timestamps, and clicking a group to navigate the map.

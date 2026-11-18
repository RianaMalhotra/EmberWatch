# ML hotspot discovery (DBSCAN)

The Explore page now includes an **ML hotspot discovery** panel. It applies DBSCAN, an unsupervised machine-learning clustering algorithm, to the **currently loaded** NASA FIRMS satellite detections. It groups qualifying hotspots within a 25 km geodesic radius when at least three observations form a dense neighborhood; isolated points are noise. Clicking a group centers the map near it.

Implementation: `frontend/src/utils/hotspotDbscan.js`, tested in `hotspotDbscan.test.js`. This algorithm does **not** require model training, labeled data, a new API key, or a database migration. It is separate from the zoom-dependent marker grouping and from the weighted environmental risk score.

**Limitations:** Clusters are spatial concentrations of observations, not confirmed wildfire incidents, fire spread predictions, or probabilities. Multiple satellite observations may correspond to one incident, and old records can appear alongside newer ones. Only the API's loaded subset (normally up to 200, capped at 1,000) is analyzed; missing/invalid coordinates and low-confidence classifications are excluded. This is a descriptive exploration tool, not an emergency alert service.

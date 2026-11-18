# Experimental forecast page

The top navigation includes **AI forecast**. This initial release displays a four-day weather-only outlook for monitored locations using live Open-Meteo hourly forecasts. It computes a provisional 0–100 weighted index from temperature, humidity, wind and rain. Daily cards show the peak hourly index and daily average. Errors and incomplete inputs produce no estimate.

**Important:** Despite the navigation label, this is **not yet an AI/ML forecast**. It uses an explicit rule-based formula, not a trained statistical model, and the number is **not a probability of wildfire occurrence**. No claims of predictive accuracy, fire spread or emergency readiness are made. A future true ML release should train on sufficiently broad, labeled historical wildfire/non-fire samples, avoid temporal/geographic leakage, evaluate out of sample, calibrate probabilities, and expose uncertainty.

The page is frontend-only, requires no new secrets, and does not change the existing risk score or NASA FIRMS data pipeline. The weather API must be reachable from the browser.
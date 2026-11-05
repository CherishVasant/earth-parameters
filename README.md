# Earth Vital Signs Forecast

A dashboard that forecasts six Earth vital signs to October 2028 and tests the forecasts against past data.
It uses plain HTML, CSS and JavaScript, so GitHub Pages can host it for free with no build step.

## Put it online

1. Create a new public repository on GitHub, for example `earth-vital-signs`.
2. Upload the **contents** of this `dashboard` folder to the top level of the repository, so `index.html` is not inside a subfolder. Include the hidden `.github` folder and `.nojekyll` file.
3. In the repository, open **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then `main` and `/ (root)`, and save.
4. After a minute or two, the site is live at `https://YOUR-USERNAME.github.io/earth-vital-signs/`.

## Keep the data fresh

`.github/workflows/update-data.yml` downloads the latest records every Monday. To run it now, open the **Actions** tab, choose **Update climate data**, then **Run workflow**.

To refresh by hand:

```bash
python scripts/update_data.py
```

## Run it on your computer

Browsers block the data file when the page is opened directly from a folder, so start a small server:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Files

- `index.html`, `styles.css` and `app.js` are the page.
- `model.js` holds the forecast methods and the tests against past data.
- `data/climate.json` holds the records.
- `scripts/update_data.py` downloads the records.

## Sources

NASA GISS GISTEMP v4, NOAA Global Monitoring Laboratory, NOAA Laboratory for Satellite Altimetry and the NSIDC Sea Ice Index.

# ColivingInvest

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.5.

The map uses Leaflet with OpenStreetMap's standard tiles, which require no API key.
A CSS filter gives the basemap a light grayscale appearance while transit overlays retain their colors.
Use the Métro, RER, and Tramway
checkboxes to show or hide each network and its entrance dots. Hover over a route
to see its line name, or hover over or tap an entrance dot to see its details.
Nearby entrances of the same station share a small dot; zoom in or click the
group to expand them. Entrances belonging to different stations stay separate.

Each network checkbox shows its operating routes and routes under construction.
Construction routes use dashed lines and include small station dots from
Île-de-France Mobilités' project datasets in the Travaux phase. Hover over or
click a future station to see its name and construction status. These dots mark
project station locations; operating station entrances retain their OSM locations.
Refresh construction routes and stations with `node scripts/update-construction-data.mjs`.

Enable "Walking streets (5/10 min)" to highlight the streets within walking reach of
the selected networks'
operating and construction stations: green for 0–5 minutes and blue for 5–10
minutes, at 4.8 km/h. These follow the OSM walking network. Future station access
is estimated from the published station location.

The Python generator and installation instructions are in
[scripts/WALKING.md](scripts/WALKING.md). Run it with `--include-construction` to
rebuild the walking assets before building the app.

Entrance coordinates come from OpenStreetMap and retain one feature per entrance
node. Route shapes and colors come from Île-de-France Mobilités. Both are served
as local GeoJSON snapshots. Run `node scripts/update-entrances.mjs` to refresh the
OSM entrances, or `node scripts/update-transit-data.mjs` to refresh the routes.
See [the data sources and licenses](public/data/README.md).

## GitHub Pages deployment

Repository: [Duluth-Technologies/paris-metro](https://github.com/Duluth-Technologies/paris-metro).
Production domain: [paris-metro.duluthtechnologies.com](https://paris-metro.duluthtechnologies.com).

Pushes to `main` and manual runs of `.github/workflows/deploy-pages.yml` build
the app with Node.js 24 and publish `dist/coliving-invest/browser` using the
official GitHub Pages actions. The custom domain uses `<base href="/">`.
Precomputed data in `public/data/` is committed and copied into the deployment;
CI does not run Python, download OSM, or recalculate walking distances.

One-time repository/domain setup:

1. In [Settings → Pages](https://github.com/Duluth-Technologies/paris-metro/settings/pages),
   set **Source** to **GitHub Actions**.
2. Set **Custom domain** to `paris-metro.duluthtechnologies.com` and save it.
   The committed `public/CNAME` records the intended domain, but Actions-based
   publishing also requires this repository setting.
3. At the DNS provider for `duluthtechnologies.com`, add a **CNAME** with name
   `paris-metro` and target `duluth-technologies.github.io` (without a path).
4. Enable **Enforce HTTPS** in Pages settings once GitHub has issued the certificate.

The build verifies that its HTML, custom-domain file, routes, entrances, and all
walking chunks are present before uploading the artifact. To perform the same
check locally, run `npm run build && node scripts/verify-pages-build.mjs`.
If the first deployment runs before Pages is enabled, rerun it from the
repository's Actions tab after completing setup.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

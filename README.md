# React Template App

This project is a small React app built with Vite and packaged as a Docker image that runs nginx. It is meant to show the full path from source code to a deployable container image published to GitHub Container Registry.

The app itself is intentionally simple. The important part is the delivery setup:

- React source code is built into static files with Vite.
- nginx serves the built files in production.
- Docker packages nginx and the static build output into one runtime image.
- GitHub Actions runs linting, tests, production build, and Docker image publishing.
- GitHub Container Registry stores the deployable image.

The goal is to make deployment boring and repeatable. A developer should be able to push code, let CI prove the app still works, and receive a versioned container image that can run the same way on any Docker-capable server.

## Application Flow

At runtime there is no Node.js server and no backend API in this project. The production container only runs nginx.

We do this because a Vite React app becomes static files after `npm run build`. Once the app is built, Node.js is no longer needed to serve it. nginx is smaller, simpler, and purpose-built for serving static files over HTTP.

Request flow:

```text
Browser
-> Docker host port
-> nginx container port 80
-> /usr/share/nginx/html
-> index.html, JS, and CSS assets
-> React runs in the browser
```

Build flow:

```text
src/*.jsx
-> npm run build
-> dist/
-> Docker image
-> nginx serves dist/
```

If a backend is added later, nginx can be extended to proxy API requests to another service, for example `/api` to a backend container.

## Local Development

Install dependencies:

```bash
npm install
```

This installs the exact libraries needed to develop, test, and build the app locally.

Run the development server:

```bash
npm run dev
```

Use this while developing because Vite gives fast local reloads and useful browser error messages.

Run linting:

```bash
npm run lint
```

Linting catches common code mistakes before they reach CI or production.

Run tests:

```bash
npm test
```

Tests prove the app still renders as expected. This project only has a basic test, but the pipeline is ready for more meaningful tests as the app grows.

Build the production static app:

```bash
npm run build
```

The production build is written to `dist/`.

Running the build locally matters because it catches problems that may not appear in the development server, such as production bundling errors or missing imports.

## Docker And nginx

The `Dockerfile` uses two stages.

We use two stages because building and running are different jobs. The build stage needs Node.js, npm, and development dependencies. The runtime stage only needs nginx and the already-built files. Keeping those concerns separate produces a smaller and cleaner production image.

Stage 1 builds the React app:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
```

This stage installs dependencies and creates the Vite production build in `dist/`.

`npm ci` is used instead of `npm install` because CI and Docker builds should be reproducible. It installs from `package-lock.json` and fails if the lockfile does not match `package.json`.

Stage 2 creates the runtime image:

```dockerfile
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

This keeps the final image smaller because it contains nginx and static files, not the Node.js toolchain or source dependencies.

A smaller runtime image is faster to pull, has less unnecessary software, and reduces the surface area for security issues.

Build the image locally:

```bash
docker build -t react-template-app:local .
```

This verifies that the same container build used in CI also works on your machine.

Run it locally:

```bash
docker run --rm -p 8080:80 react-template-app:local
```

The app listens on port `80` inside the container. The `-p 8080:80` flag maps your machine's port `8080` to the container's port `80`.

Open the app:

```text
http://localhost:8080
```

## nginx Config

The nginx config is in `nginx.conf`.

nginx is the production entry point for every browser request. The config tells nginx where the built React files live and how to respond when the browser asks for a URL.

It listens on HTTP port 80:

```nginx
listen 80;
```

Port `80` is the standard HTTP port. SSL is intentionally not configured in this template because TLS is often handled by a load balancer, reverse proxy, or hosting platform in front of the container.

It serves the static app from the standard nginx web root:

```nginx
root /usr/share/nginx/html;
index index.html;
```

The Dockerfile copies Vite's `dist/` output into `/usr/share/nginx/html`, so nginx can serve the built app directly from its default static-file location.

It supports single-page app routing:

```nginx
try_files $uri $uri/ /index.html;
```

That means a direct request to a future route such as `/dashboard` still returns `index.html`, allowing React Router or another client-side router to handle the route in the browser.

Without this fallback, refreshing `/dashboard` would make nginx look for a real `/dashboard` file or folder and return `404`. Single-page apps need the server to return `index.html` so the frontend router can take over.

It also caches fingerprinted static assets:

```nginx
location ~* \.(?:css|js|jpg|jpeg|gif|png|svg|ico|webp|woff2?)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
}
```

This is safe for Vite assets because production filenames include content hashes. When the file content changes, the filename changes too.

Long cache headers improve performance because browsers can reuse JS, CSS, images, and fonts instead of downloading them on every visit.

## CI/CD Pipeline

The pipeline is defined in `.github/workflows/ci.yml`.

The pipeline exists so the important checks are run by GitHub the same way every time. This removes guesswork from deployment and prevents publishing images from code that does not lint, test, or build.

It runs on:

- pushes to `main`
- pull requests targeting `main`

Common validation steps:

```text
checkout repository
setup Node.js 22
npm ci
npm run lint
npm test
npm run build
```

These steps are ordered from dependency setup to quality checks to production build. If any step fails, the workflow stops and no image is published.

For pull requests, the workflow also builds the Docker image locally:

```bash
docker build -t react-template-app:ci .
```

This proves the Dockerfile works before a change is merged, but it does not publish an image from pull requests.

That separation matters because pull requests may come from unfinished work or external branches. They should be validated, but they should not automatically create production deployment artifacts.

For pushes to `main`, the workflow logs in to GitHub Container Registry and publishes the Docker image.

Publishing only from `main` makes `main` the source of deployable truth. If an image exists in the registry, it came from code that passed the pipeline on the main branch.

The workflow needs this permission so GitHub Actions can publish packages:

```yaml
permissions:
  contents: read
  packages: write
```

GitHub Actions uses the built-in `GITHUB_TOKEN` to authenticate. `contents: read` lets the workflow read the repository, and `packages: write` lets it push images to GitHub Container Registry.

The image name is based on the repository:

```yaml
env:
  IMAGE_NAME: ghcr.io/${{ github.repository }}
```

The publish step pushes two tags:

```yaml
tags: |
  ${{ env.IMAGE_NAME }}:latest
  ${{ env.IMAGE_NAME }}:${{ github.sha }}
```

`latest` is convenient for simple deployments. The commit SHA tag is better for reproducible deployments because it points to one exact build.

Use `latest` when you want the newest successful main-branch build. Use the SHA tag when you need to deploy, audit, or roll back to a specific version.

## Published Image

The image is published to GitHub Container Registry:

```text
ghcr.io/mart337i/react-template-app:latest
```

The registry is the handoff point between CI and deployment. CI builds and pushes the image once. Any deployment target can then pull the same image without rebuilding the app.

Pull the published image:

```bash
docker pull ghcr.io/mart337i/react-template-app:latest
```

Run the published image:

```bash
docker run --rm -p 8080:80 ghcr.io/mart337i/react-template-app:latest
```

This command runs the exact artifact produced by the pipeline, not a local rebuild. That is useful because it verifies what would run in a real deployment environment.

## How To Build Something Similar

1. Create a React app with Vite.

```bash
npm create vite@latest my-app -- --template react
```

Vite is used because it gives a simple React development setup and produces optimized static files for production.

2. Add scripts for local checks.

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "test": "vitest run",
    "preview": "vite preview"
  }
}
```

3. Add at least one test so CI proves the app can render.

Start with a small test because the first goal is to prove the test system is wired correctly. Add business-specific tests as the app gains real behavior.

4. Add a multi-stage Dockerfile.

Use Node only for building. Use nginx for runtime serving.

This avoids shipping development tooling to production and keeps runtime responsibilities narrow.

5. Add an nginx config.

Include an SPA fallback with `try_files $uri $uri/ /index.html`.

This lets client-side routes work when users refresh the page or open a deep link directly.

6. Add a GitHub Actions workflow.

Validate every change with linting, tests, and a production build.

CI should answer the question: "Is this change safe enough to package?" If not, the failure should happen before deployment.

7. Publish only from the main branch.

Pull requests should validate. Main branch pushes should publish.

This pattern keeps feedback fast for proposed changes while reserving artifact publishing for accepted code.

8. Push the image to GHCR.

Use `docker/login-action` and `docker/build-push-action` with `GITHUB_TOKEN`.

Using GitHub's built-in token avoids storing a separate registry password in the repository secrets for this basic setup.

## Key Ideas

The build container and runtime container solve different problems. The build container needs Node.js, npm, and all development dependencies. The runtime container only needs nginx and the static files.

nginx is a good fit for this project because the app is static after `npm run build`. There is no need to run a Node.js server just to serve HTML, CSS, and JavaScript.

CI protects the main branch by running repeatable checks. CD publishes a deployable artifact only after those checks pass on `main`.

Container registry publishing makes deployment independent of the source checkout. A server or platform only needs Docker access to pull and run the image.

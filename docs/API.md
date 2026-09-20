# ThreadWeaver Local Data API Documentation

ThreadWeaver embeds an internal REST API server designed to expose conversation threads, artifacts, and project metadata locally. This makes it effortless to build external analysis tools, ingest data for training smart agents, and analyze agent behavior and user corrections based on historical project threads.

## Accessing the API

The API server runs entirely on `localhost` (`127.0.0.1`) and assigns itself a dynamic port to avoid conflicts. It is protected by a Bearer Token that changes per session.

**To find the Port and Token manually:**
1. Open the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **`ThreadWeaver: Show API Server Info`**.
3. Copy the token.

**Tool & Script Automation Discovery:**
To allow external agents and scripts to automatically connect to this API without manual intervention, ThreadWeaver writes a connection details file to your disk whenever the server starts, and cleans it up when the server stops.

**File Location:**
- Windows/Linux/macOS: `~/.gemini/threadweaver_api.json`

**File Format:**
```json
{
  "port": 50512,
  "baseUrl": "http://127.0.0.1:50512",
  "token": "1f74aec3f481ebdc...",
  "docsPath": "d:/Work/.../agy-threadweaver/docs/API.md"
}
```
External scripts should simply read this JSON file to extract the `baseUrl` and the `token`.

All API requests must include the `Authorization` header:
```http
Authorization: Bearer <YOUR_TOKEN>
```

---

## Endpoints

All endpoints are prefixed with `/api/v1`.

### 1. Workspaces
Get the top-level projects that have been discovered across your threads.

**`GET /api/v1/workspaces`**
- **Description:** Returns an array of workspaces (projects) and their aggregate thread counts.
- **Use Case:** Great for identifying top-level project structures when categorizing training data or analyzing agent performance by domain.
- **Response Format:**
  ```json
  {
    "workspaces": [
      {
        "id": "c4ca4238a0b923820dcc509a6f75849b",
        "uri": "file:///d:/Work/project-A",
        "name": "project-A",
        "path": "d:/Work/project-A",
        "color": "#123456",
        "threadCount": 4
      }
    ]
  }
  ```

**`GET /api/v1/workspaces/:id/threads`**
- **Description:** Get all lightweight thread metadata assigned to a specific workspace.
- **Parameters:** `:id` must be the MD5 hash `id` string returned from the workspaces response.

---

### 2. Threads
Get thread metadata and transcripts to visualize the agent's step-by-step history.

**`GET /api/v1/threads`**
- **Description:** Get all scanned threads.
- **Query Parameters:**
  - `status` (optional): Filter by `active`, `completed`, `error`, or `idle`.
  - `surface` (optional): Filter by `windows`, `macos`, `linux`, or `wsl`.
  - `limit` (optional): Restrict the number of threads returned.
- **Response Format:**
  ```json
  {
    "threads": [
      {
        "id": "thread-uuid",
        "title": "Build Graph Feature",
        "status": "completed",
        "metrics": { ... }
      }
    ]
  }
  ```

**`GET /api/v1/threads/:id`**
- **Description:** Retrieve the full thread bundle, including its `ThreadMeta` and its full transcript of messages/actions.
- **Response:**
  ```json
  {
    "meta": { ... },
    "transcript": [ ... ]
  }
  ```

**`GET /api/v1/threads/:id/transcript`**
- **Description:** Retrieve *only* the transcript array containing every `USER_INPUT`, `PLANNER_RESPONSE`, `TOOL_CALL`, etc.

---

### 3. Artifacts
Expose files and artifacts generated during an agent session.

**`GET /api/v1/threads/:id/artifacts`**
- **Description:** List all markdown artifacts and scratch scripts within a thread.
- **Response Format:**
  ```json
  {
    "artifacts": [
      {
        "id": "thread-uuid_plan.md",
        "name": "plan.md",
        "type": "plan",
        "sizeFormatted": "1.2 KB"
      }
    ]
  }
  ```

**`GET /api/v1/threads/:id/artifacts/:filename`**
- **Description:** Read an artifact's content along with its user-review metadata (e.g. `implementation_plan.md.metadata.json`).
- **Response Format:**
  ```json
  {
    "content": "# Implementation Plan...",
    "metadata": {
      "RequestFeedback": true,
      "UserFacing": true
    },
    "feedbackState": "pending_or_reviewed"
  }
  ```

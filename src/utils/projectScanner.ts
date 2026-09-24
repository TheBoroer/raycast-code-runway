import { readdir, stat } from "fs/promises";
import { join } from "path";
import { Project, ProjectDirectory } from "../types";

const WORKSPACE_EXTENSION = ".code-workspace";

/**
 * Determines if a directory is a project directory.
 * This is done by checking its file listing for common project indicator files.
 */
function isProjectDirectory(files: string[]): boolean {
  const projectIndicators = [
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "requirements.txt",
    "pyproject.toml",
    "Gemfile",
    "composer.json",
    ".git",
    "Makefile",
    "CMakeLists.txt",
    "Dockerfile",
  ];

  return projectIndicators.some((indicator) => files.includes(indicator));
}

/**
 * Builds project entries for the .code-workspace files in a directory listing.
 */
function findWorkspaceProjects(dirPath: string, files: string[], parentDirectory: string): Project[] {
  return files
    .filter((file) => !file.startsWith(".") && file.endsWith(WORKSPACE_EXTENSION))
    .map((file) => ({
      name: file.slice(0, -WORKSPACE_EXTENSION.length),
      path: dirPath,
      parentDirectory,
      workspaceFile: join(dirPath, file),
    }));
}

/**
 * Unique identifier for a project. Workspace entries share their folder's path, so use the file instead.
 */
export function getProjectId(project: Project): string {
  return project.workspaceFile ?? project.path;
}

/**
 * Scans a single directory for projects.
 */
export async function scanProjectsInDirectory(
  directoryPath: string,
  recursive: boolean,
  parentDirectory: string,
  currentDepth = 0,
  maxDepth = 3,
): Promise<Project[]> {
  const projects: Project[] = [];

  if (currentDepth > maxDepth) {
    return projects;
  }

  try {
    const entries = await readdir(directoryPath);

    // Deeper levels are covered by their parent's listing below
    if (currentDepth === 0) {
      projects.push(...findWorkspaceProjects(directoryPath, entries, parentDirectory));
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;

      const fullPath = join(directoryPath, entry);

      try {
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          const children = await readdir(fullPath);

          // Include workspace files even inside projects, since projects are not scanned further
          projects.push(...findWorkspaceProjects(fullPath, children, parentDirectory));

          if (isProjectDirectory(children)) {
            projects.push({
              name: entry,
              path: fullPath,
              parentDirectory: parentDirectory,
            });
          } else if (recursive) {
            projects.push(
              ...(await scanProjectsInDirectory(fullPath, recursive, parentDirectory, currentDepth + 1, maxDepth)),
            );
          }
        }
      } catch {
        // Ignore directories that cannot be accessed
        continue;
      }
    }
  } catch {
    // Ignore inaccessible root directories
  }

  return projects;
}

/**
 * Scans all configured directories for projects.
 */
export async function scanAllProjects(directories: ProjectDirectory[]): Promise<Project[]> {
  let allProjects: Project[] = [];

  for (const directory of directories) {
    if (directory.enabled) {
      try {
        const projects = await scanProjectsInDirectory(directory.path, !!directory.recursive, directory.path);
        allProjects.push(...projects);
      } catch (error) {
        console.error(`Error scanning directory ${directory.path}:`, error);
      }
    }
  }

  // Deduplicate
  allProjects = allProjects.filter(
    (project, index, self) => index === self.findIndex((p) => getProjectId(p) === getProjectId(project)),
  );

  return allProjects;
}

/**
 * Searches for projects.
 */
export function searchProjects(projects: Project[], query: string): Project[] {
  if (!query.trim()) {
    return projects;
  }

  const searchTerm = query.toLowerCase();

  return projects
    .filter(
      (project) =>
        project.name.toLowerCase().includes(searchTerm) || getProjectId(project).toLowerCase().includes(searchTerm),
    )
    .sort((a, b) => {
      // Prioritize exact name matches
      const aNameMatch = a.name.toLowerCase() === searchTerm;
      const bNameMatch = b.name.toLowerCase() === searchTerm;

      if (aNameMatch && !bNameMatch) return -1;
      if (!aNameMatch && bNameMatch) return 1;

      // Then prioritize projects whose names start with the search term
      const aStartsWithName = a.name.toLowerCase().startsWith(searchTerm);
      const bStartsWithName = b.name.toLowerCase().startsWith(searchTerm);

      if (aStartsWithName && !bStartsWithName) return -1;
      if (!aStartsWithName && bStartsWithName) return 1;

      // Finally, sort alphabetically
      return a.name.localeCompare(b.name);
    });
}

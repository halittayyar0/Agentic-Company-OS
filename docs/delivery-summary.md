# Save a delivery summary

The direct shortcut is available in current source builds after v0.5.9. In the
released v0.5.9 package, scroll to **Delivery summary** to read or download it.

Open a project and choose **View saved delivery** below its title to go directly
to the existing **Delivery summary**. The link appears only when a nonempty
summary has been saved. It preserves the current tab and unsent conversation,
and makes no model request or new task. Back returns to the previous position;
the result link can also be bookmarked or reloaded. A saved delivery is not a
claim that a recurring responsibility has finished or that the model accepted
an operator-confirmed result; review its current status and authority labels.

Choose **Download summary (.txt)** to save a UTF-8 text file named
`project-<id>-summary.txt`.
The browser controls the save location and any save prompt.

The file contains the project title, its current status, the saved summary and
an explanation that downloading the agent's report does not verify its claims.
Links and Markdown formatting remain plain text. Review the result and its
**Review evidence** records before relying on it or sharing it.

For recurring responsibilities, the file identifies the latest saved delivery
and shows the current responsibility status. A saved report can remain available
while the next cycle runs, or after a one-off project becomes recurring. The
download does not invent a delivery date or mark the responsibility finished.

Downloading prepares the file locally from the currently displayed project.
It makes no model request and starts no work. The export includes the displayed
summary rather than the project's brief, raw activity records or connection
configuration. The report itself can contain private information supplied to or
written by the agent; review the file before sharing it.

If the browser cannot prepare the file, the report stays visible and an inline
message offers another attempt. If no summary has been saved, the download
action is unavailable. Cancelling a browser save prompt does not produce an
application success claim.

Only the selected download language is loaded. If its file cannot load, the
saved report and evidence action remain available. The recovery action reloads
the page; save any unfinished text on the page first. Reloading does not start
a new task or regenerate the report.

# Tools you can try before installation

The [public start page](https://halittayyar0.github.io/Agentic-Company-OS/#try) has three small, free checks that run entirely in your browser. They do not create an agent task, use a model, require an account or send your input to a server. You can inspect the code in [`site/quick-tools.mjs`](../site/quick-tools.mjs).

| Tool            | Result                                                                                                                                        | Important limit                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| CSV check       | Data and column counts, rows with a different number of fields, exact duplicate rows, empty or duplicate headers, and blank values per column | Comma delimiter, first row treated as headers; no type inference or automatic cleaning     |
| JSON map        | Root type, top-level keys, type counts, node count and maximum nesting depth                                                                  | Standard JSON parsing; duplicate object keys are not detected and values are not displayed |
| List difference | Unique entries only in each list and entries common to both                                                                                   | Case-sensitive exact matching after trimming outer whitespace; blank lines ignored         |

Input is limited to 256 KiB. CSV supports at most 2,000 data rows and 128 columns; each list supports 2,000 lines. CSV and JSON can be pasted or read from a local file. Local file selection reads the file in your tab; the page does not upload it. The report can include column names or list entries you supplied, so inspect it before sharing. The copied follow-up task contains only the numerical summary and asks you to attach the original data in your private workspace.

The checks are deterministic starting points. They do not verify the meaning, origin or correctness of your data, and they do not modify the original file. For a larger or more involved job, install Agentic Company OS and ask an agent to inspect a private copy with your chosen permissions.

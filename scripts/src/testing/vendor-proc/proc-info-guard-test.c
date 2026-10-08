#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#define TEMP_FAILURE_RETRY(expression) \
  ({ __typeof__ (expression) result; \
     do result = (expression); while (result == -1 && errno == EINTR); result; })
#include <errno.h>
#include "proc-info-guard.c"

static bool check (const char *bytes, size_t length)
{
  FILE *file = tmpfile ();
  bool result;
  assert (file != NULL);
  assert (fwrite (bytes, 1, length, file) == length);
  assert (fflush (file) == 0);
  rewind (file);
  result = acos_proc_status_matches (fileno (file), 7);
  assert (fclose (file) == 0);
  return result;
}

int main (void)
{
  const char *refused[] = {
    "Name:\ttest\n", "NStgid:\t8\n", "NStgid:\t7\t7\n",
    "NStgid:\t7\t8\n", "NStgid:\t7\nNStgid:\t7\n",
    "NStgid:\t07\n", "NStgid:\t7", "NStgid: 7\n",
  };
  char full[16384];
  assert (check ("Name:\ttest\nNStgid:\t7\n", 21));
  for (size_t i = 0; i < sizeof refused / sizeof refused[0]; i++)
    assert (!check (refused[i], strlen (refused[i])));
  assert (!check ("NStgid:\t7\n\0\n", 12));
  memset (full, '\n', sizeof full);
  memcpy (full, "NStgid:\t7\n", 10);
  assert (!check (full, sizeof full));
  FILE *live = fopen ("/proc/self/status", "r");
  assert (live != NULL);
  assert (acos_proc_status_matches (fileno (live), getpid ()));
  assert (fclose (live) == 0);
  puts ("bounded proc NStgid guard: live positive, collision/malformed/bound negatives passed");
  return 0;
}

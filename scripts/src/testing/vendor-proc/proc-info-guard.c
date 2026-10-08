/* Explicit namespace information requires a procfs view of this PID namespace.
 * Numeric equality alone can collide with an ancestor PID. Linux NStgid must
 * contain exactly one canonical value, read with a fixed bound before clone. */
static bool
acos_proc_status_matches (int status_fd, pid_t expected_pid)
{
  char status[16384];
  char expected[64];
  size_t used = 0;
  size_t matches = 0;
  int expected_length = snprintf (expected, sizeof expected,
                                  "NStgid:\t%ld\n", (long) expected_pid);
  ssize_t count;

  if (expected_pid <= 0 || expected_length <= 0 ||
      (size_t) expected_length >= sizeof expected)
    return false;
  while (used < sizeof status)
    {
      count = TEMP_FAILURE_RETRY (read (status_fd, status + used,
                                       sizeof status - used));
      if (count < 0)
        return false;
      if (count == 0)
        break;
      used += (size_t) count;
    }
  /* Refuse a full buffer, incomplete line or embedded NUL. */
  if (used == 0 || used == sizeof status || status[used - 1] != '\n' ||
      memchr (status, '\0', used) != NULL)
    return false;
  for (size_t offset = 0; offset < used; )
    {
      char *end = memchr (status + offset, '\n', used - offset);
      size_t line_length;
      if (end == NULL)
        return false;
      line_length = (size_t) (end - (status + offset)) + 1;
      if (line_length >= 7 && memcmp (status + offset, "NStgid:", 7) == 0)
        {
          if (line_length != (size_t) expected_length ||
              memcmp (status + offset, expected, line_length) != 0)
            return false;
          matches++;
        }
      offset += line_length;
    }
  return matches == 1;
}

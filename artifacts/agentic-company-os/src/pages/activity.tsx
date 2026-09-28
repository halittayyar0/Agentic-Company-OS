import { Redirect, useSearch } from "wouter";

/** Keep old bookmarks on the canonical operations surface. */
export default function ActivityRedirect() {
  const search = useSearch();
  const previousState =
    typeof window.history.state === "object" && window.history.state !== null
      ? window.history.state
      : {};
  return (
    <Redirect
      to={`/operations${search ? `?${search}` : ""}${window.location.hash}`}
      replace
      state={{ ...previousState, acosFocusHeading: true }}
    />
  );
}

import { Component } from "react";

// #49: if drawing one part of the page throws (for example a malformed record
// that got past the API checks), show a message for that part instead of
// blanking the whole app. The header, status messages and Report a Fire panel
// sit outside the boundary, so they keep working.
function sameKeys(a = [], b = []) {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

export default class ErrorBoundary extends Component {
  state = { failed: false, resetKeys: this.props.resetKeys };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // New data may be fine, so give it a chance to render again.
  static getDerivedStateFromProps(props, state) {
    if (!sameKeys(props.resetKeys, state.resetKeys)) {
      return { failed: false, resetKeys: props.resetKeys };
    }
    return null;
  }

  componentDidCatch(error) {
    // Details go to the console only, never into the page.
    console.error(`ErrorBoundary caught an error in ${this.props.label ?? "a component"}:`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div role="alert" style={{ color: "red", margin: "8px 0" }}>
        The {this.props.label ?? "section"} could not be displayed. The rest of the page still works.{" "}
        <button type="button" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

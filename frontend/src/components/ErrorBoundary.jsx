import { Component } from "react";

// #49: if drawing part of the page throws (for example a malformed record that
// got past the API checks), show a message with a Try again button instead of
// a blank page. `note` is the sentence after the message; wrap a small part of
// the page to keep the default, or wrap everything and pass a different note.
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
        The {this.props.label ?? "section"} could not be displayed. {this.props.note ?? "The rest of the page still works."}{" "}
        <button type="button" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

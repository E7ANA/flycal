import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <h2 className="text-lg font-semibold">שגיאה בלתי צפויה</h2>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {this.state.error?.message ?? "אירעה שגיאה"}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            טען מחדש
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

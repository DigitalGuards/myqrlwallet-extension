import { ComponentType, Suspense, SuspenseProps } from "react";

const withSuspense = <P extends object>(
  Component: ComponentType<P>,
  fallback?: SuspenseProps["fallback"],
) => {
  return function WithSuspense(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Component {...props} />
      </Suspense>
    );
  };
};

export default withSuspense;

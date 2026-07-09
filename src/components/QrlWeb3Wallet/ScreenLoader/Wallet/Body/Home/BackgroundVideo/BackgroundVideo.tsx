const BackgroundVideo = () => {
  return (
    <img
      data-testid="backgroundVideoTestId"
      className="pointer-events-none absolute -left-8 top-0 z-0 h-96 w-96 scale-125 opacity-[0.08]"
      src="tree.svg"
      alt=""
      aria-hidden
    />
  );
};

export default BackgroundVideo;

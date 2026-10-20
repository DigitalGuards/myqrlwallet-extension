type AddQrlChainUrlListProps = {
  title: string;
  urlList: string[];
};

const AddQrlChainUrlList = ({ title, urlList }: AddQrlChainUrlListProps) => {
  if (urlList.length)
    return (
      <div className="flex flex-col gap-1">
        <div>{title}</div>
        {urlList.map((url, index) => (
          <div key={url} className="font-bold text-secondary">
            {index + 1}. {url}
          </div>
        ))}
      </div>
    );
  return undefined;
};

export default AddQrlChainUrlList;

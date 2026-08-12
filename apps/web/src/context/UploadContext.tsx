import { createContext, useContext } from 'react';

type UploadContextValue = {
  openUpload: () => void;
};

export const UploadContext = createContext<UploadContextValue>({
  openUpload: () => undefined
});

export const useUpload = () => useContext(UploadContext);

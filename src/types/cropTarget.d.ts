interface CropTarget {}

declare var CropTarget: {
  fromElement(element: Element): Promise<CropTarget>;
};

interface MediaStreamTrack {
  cropTo?(target: CropTarget): Promise<void>;
}

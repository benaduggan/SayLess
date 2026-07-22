import { useState, useEffect, useContext, useCallback } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

import { ContentStateContext } from "../../context/ContentState";

type ModalAction = () => void;

const Modal = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const [title, setTitle] = useState("Test");
  const [description, setDescription] = useState("Description here");
  const [button1, setButton1] = useState<string | null>("Submit");
  const [button2, setButton2] = useState<string | null>("Cancel");
  const [trigger, setTrigger] = useState<ModalAction>(() => () => {});
  const [trigger2, setTrigger2] = useState<ModalAction>(() => () => {});
  const [showModal, setShowModal] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [learnmore, setLearnMore] = useState<string | null>(null);
  const [learnMoreLink, setLearnMoreLink] = useState<ModalAction>(() => {});
  const [colorSafe, setColorSafe] = useState(false);
  const [sideButton, setSideButton] = useState<string | false>(false);
  const [sideButtonAction, setSideButtonAction] = useState<ModalAction>(() => {});

  const openModal = useCallback(
    (
      title: string,
      description: string,
      button1: string | null,
      button2: string | null,
      action: ModalAction,
      action2: ModalAction,
      image: string | null = null,
      learnMore: string | null = null,
      learnMoreLink: ModalAction | null = null,
      colorSafe = false,
      sideButton: string | false = false,
      sideButtonAction: ModalAction | null = null,
    ) => {
      // Surface which error/info modal the user saw (title is i18n-resolved here).
      try {
        chrome.runtime
          .sendMessage({
            type: "diag-forward",
            event: "sandbox-modal-open",
            data: {
              title: String(title || "").slice(0, 120),
              description: String(description || "").slice(0, 240),
            },
          })
          .catch(() => {});
      } catch {}
      setTitle(title);
      setDescription(description);
      setButton1(button1);
      setButton2(button2);
      setShowModal(true);
      setTrigger(() => action);
      setTrigger2(() => action2);
      setImage(image);
      setLearnMore(learnMore);
      setLearnMoreLink(() => learnMoreLink || (() => {}));
      setColorSafe(colorSafe);
      setSideButton(sideButton);
      setSideButtonAction(() => sideButtonAction || (() => {}));
    },
    [],
  );

  useEffect(() => {
    setContentState((prevContentState) => ({
      ...prevContentState,
      openModal: openModal,
    }));

    return () => {
      setContentState((prevContentState) => ({
        ...prevContentState,
        openModal: null,
      }));
    };
  }, []);

  return (
    <AlertDialog.Root
      open={showModal}
      onOpenChange={(open) => {
        setShowModal(open);
      }}
    >
      <AlertDialog.Trigger asChild />
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="AlertDialogOverlay" />
        <AlertDialog.Content className="AlertDialogContent">
          <AlertDialog.Title className="AlertDialogTitle">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="AlertDialogDescription">
            {description}
            {learnmore && " "}
            {learnmore && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  learnMoreLink();
                }}
                target="_blank"
              >
                {learnmore}
              </a>
            )}
          </AlertDialog.Description>
          {image && (
            <img
              src={image}
              alt=""
              style={{
                width: "100%",
                marginBottom: 15,
                marginTop: 5,
                borderRadius: "15px",
              }}
            />
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            {sideButton && (
              <button
                className="SideButtonModal"
                onClick={() => {
                  sideButtonAction();
                  setShowModal(false);
                }}
              >
                {sideButton}
              </button>
            )}
            {button2 && (
              <AlertDialog.Cancel asChild>
                <button className="Button grey" onClick={() => trigger2()}>
                  {button2}
                </button>
              </AlertDialog.Cancel>
            )}
            {button1 && (
              <AlertDialog.Action asChild>
                <button
                  className={!colorSafe ? "Button red" : "Button blue"}
                  onClick={() => trigger()}
                >
                  {button1}
                </button>
              </AlertDialog.Action>
            )}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};

export default Modal;

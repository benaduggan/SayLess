import React, { useState, useEffect, useContext, useCallback } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

// Context
import { contentStateContext } from "../context/ContentState";

const LIGHT_DOM_MODAL_STYLES = `
.AlertDialogOverlay {
  background-color: rgba(0, 0, 0, 0.5);
  position: fixed;
  inset: 0;
  animation: saylessOverlayShow 150ms cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 99999999999;
}
.AlertDialogContent {
  overflow: auto !important;
  background-color: white;
  border-radius: 30px;
  box-shadow: hsl(206 22% 7% / 35%) 0px 10px 38px -10px,
    hsl(206 22% 7% / 20%) 0px 10px 20px -15px;
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90vw;
  max-width: 500px;
  max-height: 85vh;
  padding: 35px 25px;
  animation: saylessContentShow 150ms cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 99999999999;
  font-family: "Satoshi-Medium", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.AlertDialogContent:focus { outline: none; }
.AlertDialogTitle {
  margin: 0;
  color: #29292f;
  font-size: 14px;
  line-height: 1.4;
  font-family: "Satoshi-Bold", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-weight: 700;
}
.AlertDialogDescription {
  margin-bottom: 20px;
  color: #6e7684;
  font-size: 14px;
  line-height: 1.5;
}
.AlertDialogDescription a {
  color: #3080f8 !important;
  font-weight: 600 !important;
  text-decoration: none !important;
  display: inline-block;
  cursor: pointer;
}
.AlertDialogContent .Button,
.AlertDialogContent .SideButtonModal {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 30px;
  padding: 0 15px;
  font-size: 14px;
  line-height: 1;
  font-weight: 500;
  height: 35px;
  font-family: "Satoshi-Medium", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.AlertDialogContent .Button.blue {
  background-color: rgba(48, 128, 248, 0.1);
  color: #3080f8;
}
.AlertDialogContent .Button.blue:hover {
  background-color: rgba(48, 128, 248, 0.15);
  cursor: pointer;
}
.AlertDialogContent .Button.red {
  background-color: rgba(247, 56, 90, 0.1);
  color: rgba(247, 56, 90, 1);
}
.AlertDialogContent .Button.red:hover {
  background-color: rgba(247, 56, 90, 0.15);
  cursor: pointer;
}
.AlertDialogContent .Button.grey {
  background: rgba(110, 118, 132, 0.1);
  color: #6e7684;
}
.AlertDialogContent .Button.grey:hover,
.AlertDialogContent .SideButtonModal:hover {
  background: rgba(110, 118, 132, 0.15);
  cursor: pointer;
}
.AlertDialogContent .Button:focus,
.AlertDialogContent .SideButtonModal:focus {
  box-shadow: 0px 0px 0px 2px rgba(48, 128, 248, 0.5);
}
.AlertDialogContent .SideButtonModal {
  color: #6e7684;
}
@keyframes saylessOverlayShow {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes saylessContentShow {
  from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
`;

const Modal = () => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [title, setTitle] = useState("Test");
  const [description, setDescription] = useState("Description here");
  const [button1, setButton1] = useState<string | null>("Submit");
  const [button2, setButton2] = useState<string | null>("Cancel");
  const [trigger, setTrigger] = useState<() => void>(() => () => {});
  const [trigger2, setTrigger2] = useState<() => void>(() => () => {});
  const [showModal, setShowModal] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [learnmore, setLearnMore] = useState<string | null>(null);
  const [learnMoreLink, setLearnMoreLink] = useState<string | undefined>();
  const [colorSafe, setColorSafe] = useState(false);
  const [sideButton, setSideButton] = useState(false);
  const [sideButtonAction, setSideButtonAction] = useState<() => void>(
    () => () => {}
  );

  const openModal = useCallback(
    (
      title: string,
      description: string,
      button1: string | null,
      button2: string | null,
      action: () => void,
      action2: () => void,
      image: string | null = null,
      learnMore: string | null = null,
      learnMoreLink: string | undefined = undefined,
      colorSafe = false,
      sideButton = false,
      sideButtonAction = () => {}
    ) => {
      setTitle(title);
      setDescription(description);
      setButton1(button1);
      setButton2(button2);
      setShowModal(true);
      setTrigger(() => action);
      setTrigger2(() => action2);
      setImage(image);
      setLearnMore(learnMore);
      setLearnMoreLink(learnMoreLink);
      setColorSafe(colorSafe);
      setSideButton(sideButton);
      setSideButtonAction(() => sideButtonAction);
    },
    []
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
        <style type="text/css">{LIGHT_DOM_MODAL_STYLES}</style>
        <div className="AlertDialogOverlay"></div>
        <AlertDialog.Content
          className="AlertDialogContent"
          onEscapeKeyDown={() => {
            // Escape == the cancel/secondary action. For modals that pause the
            // recording while open (restart/discard confirm), this resumes it
            // instead of leaving it stuck paused with the modal gone.
            trigger2();
          }}
        >
          <AlertDialog.Title className="AlertDialogTitle">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="AlertDialogDescription">
            {description.split("\n").map((line, idx) => (
              <React.Fragment key={idx}>
                {line}
                <br />
              </React.Fragment>
            ))}
            {learnmore && (
              <>
                {" "}
                <a href={learnMoreLink} target="_blank">
                  {learnmore}
                </a>
              </>
            )}
          </AlertDialog.Description>
          {image && (
            <img
              src={image}
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

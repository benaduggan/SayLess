import React from "react";

interface AnnouncementProps {
  setOnboarding(value: boolean): void;
}

const Announcement: React.FC<AnnouncementProps> = ({ setOnboarding }) => {
  const URL = chrome.runtime.getURL("setup.html");

  return (
    <div className="welcome">
      <div className="announcement-wrap">
        <div className="announcement-hero">
          <img src={chrome.runtime.getURL("assets/helper/hero.png")} />
        </div>
        <div className="announcement-details">
          <div className="announcement-title">
            {chrome.i18n.getMessage("updateAnnouncementTitle")} 👋
          </div>
          <div className="announcement-description">
            {chrome.i18n.getMessage("updateAnnouncementDescription")}{" "}
            <a href={URL} target="_blank">
              {chrome.i18n.getMessage("updateAnnouncementLearnMore")}
            </a>
          </div>
          <div
            className="announcement-cta"
            onClick={() => {
              setOnboarding(false);
              chrome.storage.local.set({ updatingFromOld: false });
            }}
          >
            {chrome.i18n.getMessage("updateAnnouncementButton")}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Announcement;

import styles from "../../styles/player/_Nav.module.scss";

// Icons
import { ReactSVG } from "react-svg";

const URL = chrome.runtime.getURL("assets/");

const StarIcon = URL + "editor/icons/help-nav.svg";

const PlayerNav = () => {
  return (
    <div className={styles.nav}>
      <div className={styles.navWrap}>
        <div
          onClick={() => {
            chrome.runtime.sendMessage({ type: "open-home" });
          }}
          aria-label="home"
          className={styles.navLeft}
        >
          <img src={URL + "editor/logo.svg"} alt="SayLess Logo" />
        </div>
        <div className={styles.navRight}>
          <button
            className="button simpleButton blueButton"
            onClick={() => {
              chrome.runtime.sendMessage({ type: "open-help" });
            }}
          >
            <ReactSVG src={StarIcon} />
            {chrome.i18n.getMessage("getHelpNav")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlayerNav;

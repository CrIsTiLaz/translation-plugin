import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from './BeforeDashboardServer.module.css';
export const BeforeDashboardServer = async (props)=>{
    const { payload } = props;
    const { docs } = await payload.find({
        collection: 'plugin-collection'
    });
    return /*#__PURE__*/ _jsxs("div", {
        className: styles.wrapper,
        children: [
            /*#__PURE__*/ _jsx("h1", {
                children: "Added by the plugin: Before Dashboard Server"
            }),
            "Docs from Local API:",
            docs.map((doc)=>/*#__PURE__*/ _jsx("div", {
                    children: doc.id
                }, doc.id))
        ]
    });
};

//# sourceMappingURL=BeforeDashboardServer.js.map
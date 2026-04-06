'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useConfig } from '@payloadcms/ui';
import { formatAdminURL } from 'payload/shared';
import { useEffect, useState } from 'react';
export const BeforeDashboardClient = ()=>{
    const { config } = useConfig();
    if (!config) {
        return null;
    }
    const [message, setMessage] = useState('');
    useEffect(()=>{
        const fetchMessage = async ()=>{
            const response = await fetch(formatAdminURL({
                adminRoute: config.routes.api,
                path: '/my-plugin-endpoint'
            }));
            const result = await response.json();
            setMessage(result.message);
        };
        void fetchMessage();
    }, [
        config.serverURL,
        config.routes.api
    ]);
    return /*#__PURE__*/ _jsxs("div", {
        children: [
            /*#__PURE__*/ _jsx("h1", {
                children: "Added by the plugin: Before Dashboard Client"
            }),
            /*#__PURE__*/ _jsxs("div", {
                children: [
                    "Message from the endpoint:",
                    /*#__PURE__*/ _jsx("div", {
                        children: message || 'Loading...'
                    })
                ]
            })
        ]
    });
};

//# sourceMappingURL=BeforeDashboardClient.js.map
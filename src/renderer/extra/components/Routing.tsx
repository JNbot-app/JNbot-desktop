import { FC } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

interface RouteConfig {
  path: string;
  element: React.ReactElement;
}

interface RouterProps {
  routes: RouteConfig[];
  defaultRoute?: string 
}



const AutoRedirect: FC<{ to?: string }> = ({ to }) => {
  const urlParams = new URLSearchParams(window.location.search);
  const redirectPath = urlParams.get('redirect') || to || "/";
  if (redirectPath) {
    return <Navigate to={redirectPath} replace />;
  }
  return null;
}


const Router: FC<RouterProps> = ({ routes, defaultRoute }) => {
  return (
    <HashRouter>
      <Routes>
        {
          routes.map((route) =>
            <Route key={route.path} {...route} />
          )
        }
         <Route
          path="*"
          element={<AutoRedirect to={defaultRoute} />}
        />
      </Routes>
    </HashRouter>
  );
}

export default Router;